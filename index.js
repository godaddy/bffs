'use strict';

var fs = require('fs');
var hyperquest = require('hyperquest');
var extend = require('deep-extend');
var flatten = require('lodash.flatten');
var ls = require('list-stream');
var has = require('has');
var once = require('one-time');
var async = require('async');
var parallel = require('parallel-transform');
var CDNUp = require('cdnup');
var path = require('path');
var uniq = require('uniq');
var diagnostics = require('diagnostics');

var isRedis = /^~~active/;

/**
 * Build Files Finder, BFFS <3
 *
 * Options:
 *
 * - store: Dynamis configuration.
 * - env: Allowed environment variables.
 * - cdn: Configuration for the CDN.
 *
 * @constructor
 * @param {Object} options Configuration.
 * @api private
 */
function BFFS(options) {
  if (!this) return new BFFS(options);

  options = this.init(options);

  var store = options.store;
  var prefix = options.prefix;
  var env = options.env;
  var cdn = options.cdn;

  //
  // We keep the running status of builds in redis.
  //
  this.store = store;

  //
  // Everything else we store in Cassandra.
  //
  this.datastar = options.datastar;
  this.models = options.models;
  this.log = options.log
  this.prefix = prefix;
  this.envs = env;

  this.cdns = this.cdnify(cdn);

  this.limit = options.limit;
  //
  // Always fetch by locale so we default our locale property if it does not
  // exist.
  //
  this.defaultLocale = 'en-US';
}

/**
 * Setup all required options and use fallbacks where possible.
 *
 * @param {Object} options Configuration
 * @returns {Object} options merged with defaults.
 * @api private.
 */
BFFS.prototype.init = function init(options) {
  options = options || {};
  options.cdn = options.cdn || {};
  options.env = options.env || Object.keys(options.cdn);

  if (!options.models
      || !options.datastar
      || !['BuildFile', 'Build', 'BuildHead'].every((model) => !!options.models[model])) {
    throw new Error('Requires proper datastar instance and models to be passed in, Build, BuildHead, BuildFile');
  }

  if (options.env && !Array.isArray(options.env)) {
    throw new Error('env must be an array');
  }

  return {
    cdn: options.cdn,
    env: options.env,
    models: options.models,
    datastar: options.datastar,
    store: options.store,
    prefix: options.prefix || 'wrhs',
    limit: options.limit || 10,
    log: typeof options.log === 'function' ? options.log : diagnostics('bffs')
  };
};

/**
 * Create the various CDN instances needed to upload to the world
 *
 * @param {Options} options CDN options passed into BFFS
 * @returns {Array} Array of CDNup instances.
 */
BFFS.prototype.cdnify = function cdnify(options) {
  //
  // Since dev/test are the same, filter out one of them and conditionally add
  // it
  //
  var cdns = this.envs.reduce((acc, env) => {
    options[env] = options[env] || {};
    var prefix = options[env].prefix || this.prefix;
    acc[env] = new CDNUp(prefix, extend({ env }, options[env]));
    return acc;
  }, {});

  return cdns;
};

/**
 * Get a compiled build file.
 *
 * @param {String} fingerprint The uuid of the asset.
 * @param {Boolean} gz Get a gzip based build instead.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.build = function build(fingerprint, gz, fn) {
  var key = fingerprint;

  if (gz) key += '.gz';

  this.models.BuildFile.get(key, fn);

  return this;
};

/**
 * Fetch the head based on the given spec
 *
 * @param {Object} spec Build specification { env, name }.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.head = function head(spec, fn) {
  this.models.BuildHead.get(this.normalize(spec), fn);
  return this;
};

/**
 * Get all the meta about a given build.
 *
 * @param {Object} spec Build specification we're looking for.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.meta = function meta(spec, fn) {
  var bff = this;

  async.parallel(this.envs.map(function map(env) {
    return bff.search.bind(bff, extend({}, spec, { env: env }));
  }), function metas(err, builds) {
    builds = builds.filter(Boolean);

    if (err || !builds.length) return fn(err);

    return fn(err, {
      name: spec.name,
      version: spec.version,
      envs: builds.reduce(function reduce(memo, model) {
        var build = model.toJSON();
        memo[build.env] = build;

        delete build.version;
        delete build.name;
        delete build.env;

        return memo;
      }, {})
    });
  });

  return bff;
};

/**
 * Find a release based on a given set of restrictions.
 *
 * @param {Object} spec Build specification we're looking for
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.search = function find(spec, fn) {
  this.models.Build.get(this.normalize(spec), fn);

  return this;
};

/**
 * Automatically default the spec to our defined defaultLocale.
 *
 * @param {Object} spec Build configuration
 * @returns {Object} Build configuration with locale.
 * @api public
 */
BFFS.prototype.normalize = function normalize(spec) {
  if (!spec.locale) spec.locale = this.defaultLocale;
  return spec;
};

/**
 * Alias our stream call of fetching builds for ALL locales
 *
 * @param {Object} spec Build configuration for a set of builds without locale
 * @returns {Stream} Readable stream of all builds matching the `spec`.
 * @api public
 */
BFFS.prototype.stream = function stream(spec) {
  return this.models.Build.findAll(spec);
};

/**
 * Alias our stream call of fetching build-heads for ALL locales
 *
 * @param {Object} spec Build configuration for a set of builds without locale
 * @returns {Stream} Readable stream of all builds matching the `spec`.
 * @api public
 */
BFFS.prototype.heads = function heads(spec) {
  return this.models.BuildHead.findAll(spec);
};

/**
 * Publish a new release.
 *
 * @param {Object} spec Build specification.
 * @param {Object} options Data structure.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.publish = function publish(spec, options, fn) {
  if (!spec.env) return fn(new Error('spec.env is required and must be a string.'));

  options = BFFS.normalizeOpts(options, spec.env);

  // eslint-disable-next-line no-unused-vars
  var BuildFile = this.models.BuildFile;
  var BuildHead = this.models.BuildHead;
  var Build = this.models.Build;
  var recommended = options.recommended || [];
  var artifacts = options.artifacts || [];
  var files = options.files;
  var env = spec.env;
  var bff = this;
  var payload;

  //
  // This will technically get handled by one of the model's schemas but we can
  // leave it for now
  //
  if (!spec.version) return fn(new Error('Missing version property in build spec.'));
  if (!spec.name) return fn(new Error('Missing name property in build spec.'));
  if (!~this.envs.indexOf(spec.env)) return fn(new Error('Unsupported env variable.'));

  if (!Array.isArray(files) || !files.length) return fn(new Error('options.files is required and must be an Array.'));

  //
  // Validate the build files and log successful builds
  //
  var i = files.length;
  var error;
  var data;

  while (!error && i--) {
    data = files[i];

    if (!data.compressed) {
      error = new Error('Missing builds compressed content.');
    } else if (!data.content) {
      error = new Error('Missing builds content.');
    } else if (!data.fingerprint) {
      error = new Error('Missing builds fingerprint.');
    } else if (!data.extension) {
      error = new Error('Missing builds extension.');
    }

    if (error) return fn(error);

      this.log('Publish file for %j - filename: %s, fingerprint: %s', spec, files[i].filename, files[i].fingerprint);
  }

  //
  // Generate the build information that needs to be stored. We need to do some
  // clean up as we do not want that the assets are also stored in the build
  // information as that would lead to duplicate and pointless information which
  // is why they are deleted from the payload.
  //

  payload = {
    version: spec.version,
    locale: spec.locale,
    name: spec.name,
    env: spec.env
  };

  //
  // Map the files by fingerprint.
  //
  var fileMap = files.reduce(function (acc, file) {
    acc[file.fingerprint] = file;
    return acc;
  }, {});

  //
  // Setup all the fingerprints including the gzipped ones.
  //
  var fingerprints = Object.keys(fileMap).reduce(function reduce(acc, print) {
    acc.push(print);
    acc.push(print + '.gz');
    return acc;
  }, []);

  //
  // Fetch the current head build.
  //
  this.head(spec, function gethead(err, head) {
    if (err) return fn(err);
    var cdn = bff.cdns[env];
    //
    // We need to make sure that the uploading of the assets to the CDN happens
    // before we store the meta data as we don't want any false positives in our
    // database when people are requesting meta data/build information. It's
    // better to have an extra file on the CDN in this case.
    //
    async.each(files, function upload(file, next) {
      async.parallel([
        function (fn) {
          cdn.upload(file.content, bff.key(file, 'file'), (err, url) => {
            file.url = url;
            fn(err);
          });
        },
        file.sourcemap && function (fn) {
          // URL doesnt matter since it is relative to the file that includes it
          // as a comment
          cdn.upload(file.sourcemap.content, bff.key(file.sourcemap, 'file'), fn);
        }
      ].filter(Boolean), next);
    }, function (err) {
      if (err) return fn(err);
      //
      // Built set of operations to execute with standard payload.
      //
      var operations = [Build, BuildHead].map(function (model) {
        var entity = bff.normalize(extend({
          fingerprints: fingerprints,
          createDate: new Date(),
          recommended: recommended,
          artifacts: artifacts,
          buildId: bff.key(payload),
          cdnUrl: cdn.url()
        }, payload));

        //
        // Remark (jcrugzz): We set the head buildId, which is latest build per
        // locale in the specific env to be the previousBuildId of the entity
        // we are about to publish
        //

        if (head && head.buildId) {
          entity.previousBuildId = head.buildId;
        }

        return bff._collect(model, 'create', entity);
      });

      //
      // Create the files and add to the batch.
      //
      async.map(fingerprints, (print, next) => {
        var gz = path.extname(print) === '.gz';
        var key = gz ? print.slice(0, -3) : print;
        var file = fileMap[key];
        var content;

        //
        // return a function that can be used to build a create statement with
        // the given entity
        //
        function collect(entity) {
          return bff._collect(BuildFile, 'create', entity);
        }

        //
        // Compile the entity based on parameters
        //
        function compileEntity(file, source, sourcemap) {
          var entity = extend({
            source: source,
            buildId: bff.key(payload),
            extension: file.extension,
            filename: file.filename,
            fingerprint: print,
            url: file.url
          }, payload);

          //
          // Add sourcemap if available
          //
          if (sourcemap) entity.sourcemap = sourcemap;

          return entity;
        }

        content = gz ? file.compressed : file.content;

        //
        // If we are a buffer, handle that
        //
        if (Buffer.isBuffer(content)) {
          return next(null, collect(compileEntity(file, content)));
        }

        //
        // Otherwise, handle a file path and read the contents of the file.
        // We also handle reading the sourcemap here if it exists
        //
        async.parallel([
          function (fn) {
            fs.readFile(content, fn);
          },
          file.sourcemap && function (fn) {
            fs.readFile(file.sourcemap.content, fn);
          }
        ].filter(Boolean), (err, results) => {
          if (err) return fn(err);
          next(null, collect(compileEntity(file, results[0], results[1])));
        });
      }, (err, ops) => {
        if (err) return fn(err)

        operations.push.apply(operations, ops);
        //
        // Final execution step
        //
        operations.push(function execute(statements, callback) {
          statements.execute(callback);
        });

        //
        // Ensure everything exists in the CDN before we commit to the database
        //
        bff._checkCdn(files, (err) => {
          if (err) return fn(err);

          //
          // Let it ride. Insert all the things into the database!
          //
          async.waterfall(operations, fn);
        });

      });
    });
  });

  return this;
};

/**
 * Ensure that all of our files exist in the CDN since we successfully uploaded
 * them, if not we return an error so we do not modify the state of the
 * database
 *
 * @param {Array} files File Objects that correlate to the cassandra schema
 * @param {Function} fn Completion callback
 * @returns {BFFS} The current instance
 * @api private
 *
 */
BFFS.prototype._checkCdn = function checkCdn(files, fn) {
  async.eachLimit(files, this.limit, (file, next) => {
    var nxt = once(next);
    // for whatever reason hyperquest allows this callback to be called twice
    hyperquest(file.url, (err, res) => {
      if (err) return nxt(err);
      if (res.statusCode !== 200)
        return nxt(new Error(`Failed to upload ${file.url} to CDN with statusCode ${res.statusCode}`));

      nxt();
    });
  }, fn);

  return this;
};

/**
 * Build the statement collection for the various models we are updating here
 * In the future we could wrap this up in the DAL but I think its OK here for
 * now.
 *
 * @param {datastar.Model} Model The model that needs to be created.
 * @param {String} action Action to be called on things.
 * @param {Object} entity Data for the model.
 * @returns {function} Executable function to execute statements against the Model.
 * @api private
 */
BFFS.prototype._collect = function _collect(Model, action, entity) {
  var bff = this;

  return function collection(statements, callback) {
    //
    // Handle initial case. Passing in a statement collection
    //
    if (!callback && typeof statements === 'function') {
      callback = statements;

      statements = new bff.datastar.StatementCollection(
        bff.datastar.connection,
        'batch'
      ).consistency(Model.writeConsistency);
    }

    Model[action]({
      statements: statements,
      entity: entity
    }, callback);
  };
};

/**
 * Remove a build from the registry.
 *
 * @param {Object} spec Build specification.
 * @param {Function} callback Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.unpublish = function unpublish(spec, callback) {
  var BuildFile = this.models.BuildFile;
  var BuildHead = this.models.BuildHead;
  var Build = this.models.Build;
  var fn  = once(callback);
  var bff = this;
  var operations = [];

  //
  // Grab all the builds for the given spec.
  //
  this.stream(spec)
  .on('error', fn)
  .on('data', function incoming(data) {
    //
    // This statement collection needs to be simpler would love ideas if it
    // would make sense as a separate module or something in `datastar`.
    //
    operations.push.apply(operations,
      data.fingerprints.map(function (print) {
        return bff._collect(BuildFile, 'remove', {
          fingerprint: print
        });
      })
    );

    operations.push(bff._collect(Build, 'remove', spec));
    operations.push(bff._collect(BuildHead, 'remove', spec));
  })
  .on('end', function end() {
    operations.push(function execute(statements, next) {
      if (!next && typeof statements === 'function') {
        return process.nextTick(statements);
      }

      statements.execute(next);
    });

    async.waterfall(operations, fn);
  });

  return bff;
};

/**
 * Execute a Rollback operation for the current HEAD version to the previous
 * build or a given version.
 *
 * @param {Object} spec Build specification (limited to name, env)
 * @param {String} version Version to rollback to (optional)
 * @param {Function} callback Continuation function
 */
BFFS.prototype.rollback = function rollback(spec, version, callback) {
  var BuildHead = this.models.BuildHead;
  var Build = this.models.Build;
  var bff = this;

  if (typeof version === 'function' && !callback) {
    callback = version;
    version = null;
  }

  var fn = once(callback);
  var operations = [];

  //
  // I dont even.... For some reason I added value to build?
  // I am disappointed in past me but we cannot change this
  // unless we 1. drop tables or 2. we add a useless value named VALUE!?!?
  // to the buildHead schema... for now we just strip it.
  //
  function strip(build) {
    var b = build.toJSON();
    delete b.value;
    //
    // Also remove createDate because null is not valid and it should be generated
    //
    delete b.createDate;
    //
    // We remove the previousBuildId when we do a `create` on a falsey value as
    // it causes validation to fail as it is not a string.
    //
    if (has(b, 'previousBuildId')
        && (b.previousBuildId === null
            || typeof b.previousBuildId === 'undefined'))
      delete b.previousBuildId;
    return b;
  }

  //
  // 1. Fetch the current version being returned
  // Remark: Im actually not sure whats faster or better for C* here but we can
  // do a number of things...
  //  a. Fetch the head to get the previous version, then fetch the all of the heads
  //  while also fetching all of the builds for that particular version
  //  represented by the head. THis would get us 2 associative arrays by locale
  //  b. The way we are doing it here, fetch all the heads in a stream and
  //  indivdally fetch the builds based on the previousBuildId with
  //  a reasonable concurrency to get better associated data-structures without
  //  annoying transformations.
  //
  this.heads(spec)
    .on('error', fn)
    .pipe(parallel(this.limit, (head, next) => {
      var ver = version;
      //
      // 2. Figure out what version we are dealing with here
      //
      if (!ver) {
        ver = this.respec(head.previousBuildId).version;
      }

      var locale = head.locale;

      //
      // 3. Fetch the previous version that we are rolling back to
      //
      this.search(Object.assign({ locale, version: ver }, spec), (err, build) => {
        if (err) return next(err);

        //
        // If there is no build we have a bad record that is somehow missing
        // a locale build. NOT SURE HOW THIS HAPPENS but we should be defensive
        // and just filter it out of this operation
        //
        if (!build) return next();
        //
        // 4. Set the rollbackBuildIds map appropriately for the rollback
        //    operation being performed so we don't lose history. We set the
        //    rollbackBuildIds property on what will become the new HEAD (which
        //    is a previous build)
        //
        var rollbackId = this.key(Object.assign({
          locale, version: head.version
        }, spec));

        build.rollbackBuildIds = build.rollbackBuildIds || {};
        build.rollbackBuildIds[new Date()] = rollbackId;

        next(null, build);
      });
    }))
    .on('error', fn)
    .on('data', (build) => {
      //
      // 6. Replace the build HEAD to what we are rolling back to and the build
      //    itself so it gets the updated rollbackBuildIds
      //
      operations.push(bff._collect(BuildHead, 'create', strip(build)));
      operations.push(bff._collect(Build, 'update', build));

    })
    .on('end', () => {
      operations.push(function execute(statements, next) {
        if (!next && typeof statements === 'function') {
          return process.nextTick(statements);
        }

        statements.execute(next);
      });

      async.waterfall(operations, fn);
    });
};

/**
 * Generate the cache key that was used to store a certain build.
 *
 * @param {Object} spec Build specification.
 * @param {String} wot What kind of key are we generating. (i.e. "U wot m8?")
 * @returns {String} The key of the specification based on the current state.
 * @api private
 */
BFFS.prototype.key = function key(spec, wot) {
  switch (wot) {
    case 'file':
      return `${spec.fingerprint}/${spec.filename}`;

    case 'active':
      return ['~~active', spec.name, spec.env, spec.version].join('!');

    case 'partial':
      spec = this.normalize(spec);
      return ['~~active', spec.name, spec.env, spec.version, spec.locale].join('!');

    default:
      spec = this.normalize(spec);
      //
      // My thought here is to create a single delimiter since if we are using
      // this as the buildId and previousBuildId, we would have to parse it in
      // order to actually fetch the build from the build table since we are using
      // composite keys to be nice to cassandra
      //
      return [spec.name, spec.env, spec.version, spec.locale].join('!');
  }
};

/**
 * Turn the given key into a spec object
 *
 * @param {String} key The given compiled key
 * @returns {Object} The normalized spec.
 */
BFFS.prototype.respec = function respec(key) {
  var parts = key.split('!');
  var spec = {};

  if (isRedis.test(key)) {
    spec.name = parts[1];
    spec.env = parts[2];
    spec.version = parts[3];
    if (parts[4]) spec.locale = parts[4];
  } else {
    spec.name = parts[0];
    spec.env = parts[1];
    spec.version = parts[2];
    spec.locale = parts[3];
  }

  return spec;
};

/**
 * Store the build id for a specified time.
 *
 * @param {Object} spec Build specification.
 * @param {String} id Unique uuid v4 representing the build id.
 * @param {Number} timeout How long is the build allowed to run.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.start = function start(spec, id, timeout, fn) {
  var bff = this;

  // Dont start the same build twice for the same locale
  return bff.partial(spec, function partial(err, running) {
    if (err || running) {
      return fn(err || new Error('Build for ' + spec.name + ' already in progress'));
    }

    bff.store.setex(bff.key(spec, 'partial'), timeout, id, fn);
  });
};

/**
 * Remove the build id from cache.
 *
 * @param {Object} spec Build specification.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.stop = function stop(spec, fn) {
  this.store.del(this.key(spec, 'partial'), fn);
  return this;
};

/**
 * Get the individual job based on the spec passed in
 *
 * @param {Object} spec Build specification
 * @param {Function} fn Completion callback
 * @api public
 *
 */
BFFS.prototype.partial = function partial(spec, fn) {
  this.store.get(this.key(spec, 'partial'), fn);
};

/**
 * Remove the build id from cache.
 *
 * @param {Object} spec Build specification.
 * @param {Function} fn Completion callback.
 * @returns {BFFS} The current instance (for fluent/chaining API).
 * @api public
 */
BFFS.prototype.wipe = function cancel(spec, fn) {
  var done = once(fn);
  var commands = [];

  this.store.scanStream({
    match: this.key(spec, 'active') + '*'
  })
  .on('error', done)
  .on('data', keys => {
    for (let key of keys) {
      commands.push(['del', key]);
    }
  })
  .on('end', () => {
    if (!commands.length) return done();
    this.store.multi(commands).exec(done);
  });
  return this;
};

/**
 * List the active build IDs
 *
 * @param {Object} spec Build specification
 * @param {Function} fn Completion callback.
 * @api public
 */
BFFS.prototype.active = function active(spec, fn) {
  this.store.scanStream({
    match: this.key(spec, 'active') + '*'
  }).pipe(ls.obj((err, keys) => {
    if (err) return fn(err);
    keys = flatten(keys);
    return keys.length
      ? this.store.mget(keys, (err, vals) => {
        if (err) return fn(err);
        fn(null, keys.map((key, i) => ({ key: key, value: vals[i] })));
      })
      : fn(null, []);
  }));
};

/**
 * Default configuration for the module.
 *
 * @type {Object}
 * @private
 */
BFFS.defaults = {
  cache: {
    maximum: '20 mb',
    key: true
  }
};

//
// Expose the BFFS Interface.
//
module.exports = BFFS;

/**
 * Transforms all of the possible `options` into a consistent set
 * of expected values for future use based on the `env`.
 *
 * @param {Object} options Set of denormalized options
 *   - config: fully read wrhs.toml config
 * @param {string} env Current environment for the build.
 *
 * @returns {Object} Partioned and filtered set of files from config
 */
BFFS.normalizeOpts = function normalizeOpts(options, env) {
  options = options || {};

  const result = {};
  const config = options.config || { files: {} };
  const files = { all: options.files || [] };
  files.noSourceMap = files.all.filter((file) => file.extension !== '.map');
  files.sourceMap = files.all.filter((file) => file.extension === '.map');

  const recommended = config.files[env] || [];
  //
  // XXX Merge all defined environments into the sum of artifacts that we will
  // be storing if they exist
  //
  const artifacts = uniq(Object.keys(config.files).reduce((acc, env) => {
    const files = config.files[env];
    acc.push.apply(acc, files);
    return acc;
  }, []));

  //
  // Make a lookup table for sourceMap files
  //
  const sourceMaps = files.sourceMap.reduce((acc, file) => {
    const nomap = file.filename.slice(0, -(path.extname(file.filename).length));
    acc[nomap] = file;
    return acc;
  }, {});

  function filePath(file) {
    return file && file.fingerprint && file.filename
      ? path.join(file.fingerprint, file.filename)
      : null;
  }

  function normalize(fileP) {
    const base = path.basename(fileP);
    // XXX: we can make a lookup table if this is too expensive on each .map call
    const file = files.all.find((file) => file.filename === base);
    return filePath(file);
  }

  //
  // Create the proper URL paths for the artifacts we are storing in the CDN as the
  // array we store in cassandra
  //
  result.artifacts = artifacts.length
    ? artifacts.map(normalize).filter(Boolean)
    : files.noSourceMap.map((file) => filePath(file))

  result.recommended = recommended.map(normalize).filter(Boolean);
  //
  // XXX: Filter and map the files so we store the path to the sourcemap as the sourcemap
  // of the file it references. It doesnt need to be stored as a separate
  // build-file
  //
  result.files = files.noSourceMap.map((file) => {
    const sourceMap = sourceMaps[file.filename];
    if (sourceMap) file.sourcemap = sourceMap;
    return file;
  });

  return result;
}
