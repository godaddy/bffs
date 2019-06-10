'use strict';

/* eslint max-nested-callbacks: 0 */
/* eslint no-sync: 0 */
/* eslint no-invalid-this: 0 */
/* eslint no-redeclare: 0 */

var wrhs = require('warehouse-models');
var fingerprinting = require('fingerprinting');
var path = require('path');
var url = require('url');
var extend = require('deep-extend');
var fixture = require('./fixture');
var config = require('../config');
var Redis  = require('ioredis');
var uuid = require('uuid');
var omit = require('lodash.omit');
var request = require('request');
var Datastar = require('datastar');
var assume = require('assume');
var async = require('async');
var sinon = require('sinon');
var diagnostics = require('diagnostics');
var BFFS = require('..');
var fs = require('fs');
var bffConfig = require('./config');

assume.use(require('assume-sinon'));

describe('bffs', function () {

  this.timeout(20000);

  var datastar;
  var models;
  var redis;
  var files;
  var data;
  var spec;
  var bffs;

  //
  // Setup datastar and the models before anything else
  //
  before(function (next) {
    datastar = new Datastar(config);
    models = wrhs(datastar);
    redis = new Redis()
      .on('error', err => console.error(err));

    datastar.connect(function (err) {
      if (err) return next(err);
      models.ensure(next);
    });
  });

  after(function (next) {
    redis.disconnect();
    models.drop(() => datastar.close(next));
  });

  beforeEach(function (next) {
    bffs = new BFFS(extend({
      log: sinon.spy(diagnostics('bffs-test')),
      datastar: datastar,
      models: models,
      store: redis
    }, bffConfig));

    data = fixture.files.files[0];
    files = fixture.files;
    spec = fixture.spec;

    bffs.publish(spec, files, next);
  });

  //
  // Generate a file that can be published
  //
  function generateFile(msg, filename, fingerprint) {
    filename = filename || uuid() + '.js';
    var base  = path.join(require('os').tmpdir(), filename);
    var content = base;
    var compressed = base + '.gz';
    var gzipMsg = require('zlib').gzipSync(msg);

    fs.writeFileSync(content, msg);
    fs.writeFileSync(compressed, gzipMsg);

    return {
      extension: path.extname(filename),
      filename: filename,
      content: content,
      actualContent: msg,
      compressed: compressed,
      actualCompressed: gzipMsg,
      fingerprint: fingerprint || fingerprinting(filename, { content: fs.readFileSync(base) }).id
    };
  }

  function reqExist(url, done) {
    const gz = url + '.gz';
    async.parallel([
      (next) => request({ url, strictSSL: false }, (err, res, body) => next(err, body)),
      (next) => request({ url: gz, strictSSL: false }, (err, res, body) => next(err, body))
    ], done);
  }

  afterEach(function (next) {
    bffs.unpublish(spec, next);
  });

  describe('#normalizeOpts', function () {
    const denormalizedConfig = {
      files: [{
        extension: '.js',
        filename: 'testme.andthen.js',
        fingerprint: 'a083jada091tr0l0l01zdjD'
      }, {
        extension: '.map',
        filename: 'testme.andthen.js.map',
        fingerprint: '8b45ace664325c31fa95bcf0d56e940f'
      }],
      config: {
        files: {
          dev: ['testme.andthen.js']
        }
      }
    };

    it('will not throw with no options', function () {
      const result = BFFS.normalizeOpts();

      assume(result).is.an('object');
      assume(result.artifacts).is.an('array');
      assume(result.recommended).is.an('array');
      assume(result.files).is.an('array');
    });

    it('promotes file if not explicit `false`', function () {
      let result = BFFS.normalizeOpts(denormalizedConfig);

      assume(result).is.an('object');
      assume(result).to.have.property('promote', true);

      result = BFFS.normalizeOpts({
        promote: false,
        ...denormalizedConfig
      });

      assume(result).to.have.property('promote', false);
    });

    it('will recommend files for upload based on config', function () {
      const result = BFFS.normalizeOpts(denormalizedConfig);
      const combined = [
        denormalizedConfig.files[0].fingerprint,
        denormalizedConfig.files[0].filename
      ].join(path.sep);

      assume(result).is.an('object');
      assume(result.artifacts).is.an('array');
      assume(result.artifacts).to.deep.equal([combined]);
      assume(result.recommended).is.an('array');
      assume(result.recommended).to.deep.equal([combined]);
      assume(result.files).is.an('array');
      assume(result.files[0]).to.deep.equal(denormalizedConfig.files[0]);
      assume(result.files[0].sourcemap).to.deep.equal({
        extension: '.map',
        filename: denormalizedConfig.files[1].filename,
        fingerprint: denormalizedConfig.files[0].fingerprint
      });
    });

    it('will not throw with no files config option', function () {
      const result = BFFS.normalizeOpts({});
      assume(result).is.an('object');
      assume(result.artifacts).is.an('array');
      assume(result.recommended).is.an('array');
      assume(result.files).is.an('array');
    });
  });

  it('can be initialized without `new`', function () {
    // eslint-disable-next-line new-cap
    bffs = BFFS({ models: models, datastar: datastar, store: redis });
  });

  it('will throw when initialized without the models', function () {
    function init() { bffs = new BFFS(); }
    assume(init).throws(/Requires proper datastar instance and models/);
  });

  it('will throw without a datastar instance', function () {
    function init() { bffs = new BFFS({ models: models }); }
    assume(init).throws(/Requires proper datastar instance and models/);
  });

  describe('#cdn', function () {
    it('can check file like objects for 200s', function (next) {
      bffs._checkCdn([
        { url: 'https://github.com' }
      ], bffs.cdns.dev, (err) => {
        assume(err).is.falsey();
        next();
      });
    });

    it('will error when an object is not', function (next) {
      bffs._checkCdn([
        { url: 'https://img1.wsimg-com.ide/' + bffs.prefix + '/8976456/nts.js' }
      ], bffs.cdns.dev, (err) => {
        assume(err).is.an('error');
        next();
      });
    });
  });

  it('stores additional meta data', function (next) {
    bffs.search(spec, function (err, result) {
      /* istanbul ignore next */
      if (err) return next(err);

      assume(result).is.a('object');
      assume(result.name).equals(spec.name);
      assume(result.version).equals(spec.version);
      assume(result.env).equals(spec.env);
      assume(result.fingerprints).contains(data.fingerprint);

      next();
    });
  });

  it('does not store the content in the meta data', function (next) {
    bffs.search(spec, function (err, result) {
      /* istanbul ignore next */
      if (err) return next(err);

      assume(result.content).is.falsey();
      assume(result.compressed).is.falsey();

      next();
    });
  });

  it('validates data before publishing', function (done) {
    var next = assume.wait(9, 9, done);

    bffs.publish({}, {}, function (err) {
      assume(err.message).match(/spec.env is required/i);
      next();
    });

    bffs.publish({ env: 'prod', version: 1 }, {}, function (err) {
      assume(err.message).match(/missing name/i);
      next();
    });

    bffs.publish({ env: 'prod', name: 'w' }, {}, function (err) {
      assume(err.message).match(/missing version/i);
      next();
    });

    bffs.publish({ version: 1, name: 'w', env: 'l' }, {}, function (err) {
      assume(err.message).match(/unsupported env/i);
      next();
    });

    bffs.publish(spec, { files: [] }, function (err) {
      assume(err.message).match(/must be an Array/i);
      next();
    });

    bffs.publish(spec, { files: [{}] }, function (err) {
      assume(err.message).match(/compressed/i);
      next();
    });

    bffs.publish(spec, { files: [{ compressed: 'a' }] }, function (err) {
      assume(err.message).match(/content/i);
      next();
    });

    bffs.publish(spec, { files: [{ compressed: 'a', content: 'a' }] }, function (err) {
      assume(err.message).match(/fingerprint/i);
      next();
    });

    bffs.publish(spec, { files: [{ compressed: 'a', content: 'a', fingerprint: 1 }] }, function (err) {
      assume(err.message).match(/extension/i);
      next();
    });
  });

  it('will log info to console when calling publish', function () {
    assume(bffs.log.callCount).equals(1);
  });

  it('will not create BuildHead on publish when options.promote=false', function (next) {
    var newSpec = extend({}, spec, { version: '1.0.0' });
    var opts = extend({}, fixture.files, { promote: false });
    var buildSpy = sinon.spy(bffs.models.Build, 'create');
    var headSpy = sinon.spy(bffs.models.BuildHead, 'create');

    bffs.publish(newSpec, opts, function (err) {
      assume(err).is.falsey();
      assume(headSpy).is.not.called();
      assume(buildSpy).is.called();
      sinon.restore();
      bffs.unpublish(newSpec, next);
    });
  });

  it('will promote a given build that has already been published to create buildhead', function (next) {
    var newSpec = extend({}, spec, { version: '1.0.0' });
    var opts = extend({}, fixture.files, { promote: false });
    var buildSpy = sinon.spy(bffs.models.Build, 'create');
    var headSpy = sinon.spy(bffs.models.BuildHead, 'create');

    bffs.publish(newSpec, opts, function (err) {
      assume(err).is.falsey();
      assume(headSpy).is.not.called();
      assume(buildSpy).is.called();

      bffs.promote(newSpec, (err) => {
        assume(err).is.falsey();
        assume(headSpy).is.called();
        bffs.head(newSpec, (err, head) => {
          assume(err).is.falsey();
          assume(head.version).equals(newSpec.version);
          bffs.unpublish(newSpec, next);
        });
      });
    });
  });

  it('stores files in the cdn', function (next) {
    var upload = {
      name: 'cdn-example',
      version: '0.0.1',
      env: 'test'
    };

    var msg = 'cdn-ftw, ' + Math.random();
    var base  = path.join(require('os').tmpdir(), '24-finger-prints.js');
    var content = base;
    var compressed = base + '.gz';

    fs.writeFileSync(content, msg);
    fs.writeFileSync(compressed, require('zlib').gzipSync(msg));

    bffs.publish(upload, {
      files: [
        {
          content: content,
          compressed: compressed,
          fingerprint: '897687a456',
          filename: '24-finger-prints.js',
          extension: '.js'
        }
      ]
    }, function published(err) {
      if (err) return next(err);

      reqExist(bffs.cdns[upload.env].url() + '897687a456/24-finger-prints.js', function (error, [one, two]) {
        if (error) return next(error);

        assume(one).equals(msg);
        assume(two).exists();
        cleanup();
      });
    });

    function cleanup() {
      async.series([
        bffs.unpublish.bind(bffs, upload),
        bffs.cdns[upload.env].client.removeFile.bind(
          bffs.cdns[upload.env].client,
          bffs.prefix, '897687a456/24-finger-prints.js'
        )
      ], next);
    }
  });

  it('returns nothing for unknown builds', function (next) {
    bffs.build('i dont really exist', true, function (err, data) {
      assume(err).is.falsey();
      assume(data).is.falsey();

      bffs.build('i dont really exist', false, function (error, data) {
        assume(error).is.falsey();
        assume(data).is.falsey();

        next();
      });
    });
  });

  it('properly sets the `previousBuildId` on a subsequent publish of the same package', function (done) {
    var newSpec = extend({}, spec, { version: '0.0.2' });
    var newFiles = files;

    newFiles.files = newFiles.files.map(file =>
      extend({}, file, { fingerprint: file.fingerprint + '87' }));

    var prevBuildId = bffs.key(spec);

    bffs.publish(newSpec, newFiles, err => {
      if (err) return done(err);

      var next = assume.wait(2, 6, cleanup);

      bffs.search(newSpec, (err2, build) => {
        assume(err2).is.falsey();
        assume(build).is.an('object');
        assume(build.previousBuildId).equals(prevBuildId);
        next();
      });

      bffs.head(newSpec, (error, buildHead) => {
        assume(error).is.falsey();
        assume(buildHead).is.an('object');
        assume(buildHead.previousBuildId).equals(prevBuildId);
        next();
      });
    });

    function cleanup() {
      bffs.unpublish(newSpec, done);
    }
  });

  it('returns nothing for unknown seraches', function (next) {
    bffs.search({ name: 'a', version: 'foo', env: 'reasons' }, function (err, data) {
      assume(err).is.falsey();
      assume(data).is.falsey();

      next();
    });
  });

  it('removes all build information with unpublish', function (next) {
    bffs.unpublish(spec, function (err, result) { // eslint-disable-line no-unused-vars
      /* istanbul ignore next */
      if (err) return next();

      bffs.build(data.fingerprint, false, function (err2, result) {
        /* istanbul ignore next */
        if (err2) return next();

        assume(result).is.falsey();

        bffs.build(data.fingerprint, true, function (err3, result) {
          /* istanbul ignore next */
          if (err3) return next();

          assume(result).is.falsey();

          bffs.search(spec, function (error, result) {
            /* istanbul ignore next */
            if (error) return next();

            assume(result).is.falsey();

            next();
          });
        });
      });
    });
  });

  it('publishes builds using correct artifacts and recommended values', function (next) {
    var spec = { name: 'email', version: '0.2.0', env: 'test' };
    var names = ['email.js', 'email.css'];
    var sourcemapNames = ['email.js.map', 'email.css.map'];
    var resources = names.map((name) => generateFile(`${name}/*content*/`, name));
    var sourcemaps = sourcemapNames.map((name) => {
      var base = name.slice(0, -(path.extname(name).length));
      var ref = resources.find((res) => res.filename === base);
      return generateFile(`${name}/*map of ${ref.filename}*/`, name, ref.fingerprint);
    });

    var files = resources.concat(sourcemaps);
    var fileMap = files.reduce((acc, file) => {
      acc[bffs.key(file, 'file')] = file;
      return acc;
    }, {});

    var options = {
      files: files,
      config: {
        files: {
          test: names
        }
      }
    };

    bffs.publish(spec, options, function (err) {
      if (err) return next(err);

      bffs.search(spec, function (err2, build) {
        if (err2) return cleanup(err2);
        assume(build.artifacts).is.an('array');
        assume(build.artifacts.length).eql(names.length);
        assume(build.artifacts.sort()).eql(
          files.filter((file) => file.extension !== '.map')
            .map((file) => bffs.key(file, 'file'))
            .sort()
        );
        assume(build.cdnUrl).eql(bffs.cdns[spec.env].url());

        async.each(build.artifacts, (arti, fn) => {
          var fullUrl = url.resolve(build.cdnUrl, arti);
          request({
            url: fullUrl,
            strictSSL: false
          }, (err3, res, body) => {
            if (err3) return fn(err3);
            assume(body).equals(fileMap[arti].actualContent);

            request({
              url: fullUrl + '.map',
              strictSSL: false
            }, (error, res, body) => {
              if (error) return fn(error);
              assume(body).equals(fileMap[arti + '.map'].actualContent);
              fn();
            });
          });

        }, cleanup);
      });
    });

    function cleanup(error) {
      bffs.unpublish(spec, err => next(error || err));
    }
  });

  function generatePublishStub(spec, names) {
    var options = {
      files: names.map(name => {
        return generateFile(
          `module.exports = { name: ${name}, version: ${spec.version} }`
        );
      })
    };
    return options;
  }

  describe('#rollback', function () {

    function validate(spec, assumed, callback) {
      async.parallel({
        head: bffs.head.bind(bffs, spec),
        build: bffs.search.bind(bffs, assumed.spec)
      }, (err, result) => {
        assume(err).to.be.falsey();
        assume(result.head.version).equals(assumed.spec.version);
        assume(result.head.env).equals(assumed.spec.env);
        assume(result.head.name).equals(assumed.spec.name);
        assume(omit(result.head.toJSON(), ['createDate', 'udpateDate'])).deep.equals(omit(result.build.toJSON(), ['createDate', 'udpateDate', 'value']));

        async.each(result.head.artifacts, (arti, next) => {
          var fullUrl = url.resolve(result.head.cdnUrl, arti);
          request({
            url: fullUrl,
            strictSSL: false
          }, (error, res, body) => {
            if (error) return next(error);
            assume(body).equals(assumed.fileMap[arti].actualContent);
            next();
          });
        }, callback);
      });
    }

    var names = ['whatever.js', 'something-else.js'];
    var bareSpec = { name: 'whatever', env: 'test' };
    var spec = Object.assign({}, bareSpec, { version: '0.6.0' });
    var options = generatePublishStub(spec, names);
    var fileMap;

    var spec1 = Object.assign({}, bareSpec, { version: '0.6.1' });
    var options1 = generatePublishStub(spec1, names);
    var fileMap1;

    var spec2 = Object.assign({}, bareSpec, { version: '0.6.2' });
    var options2 = generatePublishStub(spec2, names);

    before(function (done) {
      fileMap = options.files.reduce((acc, file) => {
        acc[bffs.key(file, 'file')] = file;
        return acc;
      }, {});

      fileMap1  = options1.files.reduce((acc, file) => {
        acc[bffs.key(file, 'file')] = file;
        return acc;
      }, {});

      async.series([
        bffs.publish.bind(bffs, spec, options),
        bffs.publish.bind(bffs, spec1, options1),
        bffs.publish.bind(bffs, spec2, options2)
      ], done);
    });

    it('should be able to rollback to the given version number', function (done) {
      bffs.rollback(bareSpec, '0.6.1', function (err) {
        assume(err).is.falsey();
        validate(bareSpec, {
          spec: spec1,
          options: options1,
          previous: bffs.key(spec1),
          fileMap: fileMap1
        }, done);
      });
    });

    it('should be able to rollback to the previous version', function (done) {
      bffs.rollback(bareSpec, function (err) {
        assume(err).to.be.falsey();
        validate(bareSpec, {
          spec,
          options,
          previous: bffs.key(spec),
          fileMap
        }, done);
      });
    });

    after(function (done) {
      async.series([
        bffs.unpublish.bind(bffs, spec),
        bffs.unpublish.bind(bffs, spec1),
        bffs.unpublish.bind(bffs, spec2)
      ], done);
    });

  });

  it('marks a build as active', function (next) {
    var spec = { name: 'a', version: 'foo', env: 'reasons' };
    var id = '080a9809af-adfa89-adaf8981';
    var timeout = 1000;

    bffs.start(spec, id, timeout, function (err) {
      /* istanbul ignore next */
      if (err) return next(err);

      bffs.active(spec, function (err2, active) {
        /* istanbul ignore next */
        if (err2) return next(err2);

        assume(active).is.truthy();
        assume(active.length);

        bffs.partial(spec, function (error, uuid) {
          if (error) return next(error);

          assume(uuid).equals(id);
          bffs.stop(spec, next);
        });
      });
    });
  });

  it('checks if build are active', function (next) {
    var spec = { name: 'bar', version: 'foo', env: 'reasons' };
    var id = '080a9809af-adfa89-adaf8981';
    var timeout = 1000;

    bffs.active(spec, function (err, recs) { // eslint-disable-line no-unused-vars
      /* istanbul ignore next */
      if (err) return next(err);

      bffs.start(spec, id, timeout, function (err2) {
        /* istanbul ignore next */
        if (err2) return next(err2);

        bffs.active(spec, function (err3, active) {
          /* istanbul ignore next */
          if (err3) return next(err3);

          assume(active).is.truthy();

          bffs.partial(spec, function (error, uuid) {
            if (error) return next(error);

            assume(uuid).equals(id);

            bffs.stop(spec, next);
          });
        });
      });
    });
  });

  it('will cancel all builds for the same namespace of keys', function (next) {
    var spec = { name: '@ux/uxcore2', version: '1.0.0', env: 'prod' };
    var locales = ['en-US', 'en-CA', 'en-GB'];
    var id = '080a9809af-adfa89-adaf8981';
    var timeout = 1000;

    async.each(locales, (locale, fn) => {
      bffs.start(extend({ locale: locale }, spec), id, timeout, fn);
    }, err => {
      if (err) return next(err);
      bffs.active(spec, (err2, active) => {
        if (err2) return next(err2);
        assume(active).is.truthy();
        assume(active.length).equals(3);
        bffs.wipe(spec, err3 => {
          if (err3) return next(err3);
          bffs.active(spec, (error, active) => {
            if (error) return next(error);
            assume(active.length).equals(0);
            next();
          });
        });
      });
    });
  });

  it('automatically marks the build as stopped when timeout is passed', function (next) {
    var spec = { name: 'another', version: 'foo', env: 'reasons' };
    var id = '080a9809af-adfa89-adaf8981';
    var timeout = 1;

    this.timeout(5000);

    bffs.start(spec, id, timeout, function (err) {
      /* istanbul ignore next */
      if (err) return next(err);

      setTimeout(function () {
        bffs.partial(spec, function (error, active) {
          /* istanbul ignore next */
          if (error) return next(error);

          assume(active).is.falsey();
          next();
        });
      }, timeout * 1000);
    });
  });

  it('cannot start another build if its not stopped', function (next) {
    var spec = { name: 'spekkie', version: 'foo', env: 'reasons' };
    var id = '080a9809af-adfa89-adaf8981';
    var timeout = 1000;

    bffs.start(spec, id, timeout, function (error) {
      /* istanbul ignore next */
      if (error) return next();

      bffs.start(spec, id + 'another', timeout, function (err) {
        assume(err).is.a('error');
        assume(err.message).includes('already in progress');
        assume(err.message).includes(spec.name);

        bffs.stop(spec, next);
      });
    });
  });

  describe('#meta', function () {
    beforeEach(function each(next) {
      bffs.publish(extend({}, spec, { env: 'dev' }), files, next);
    });

    afterEach(function aeach(next) {
      bffs.unpublish(extend({}, spec, { env: 'dev' }), next);
    });

    it('fetches all the build information for each environment', function (next) {
      bffs.meta(spec, function (err, build) {
        /* istanbul ignore next */
        if (err) return next();

        assume(build).is.a('object');
        assume(build.version).equals(spec.version);
        assume(build.name).equals(spec.name);
        assume(build.envs).is.a('object');
        assume(build.envs.dev).is.a('object');
        assume(build.envs.test).is.a('object');
        // Remark: If we need the URL on this meta call we need to make another
        // request for the buildFile itself
        // XXX: This will be re-added
        // assume(build.envs.prod.url).equals('/'+ data.fingerprint +'.js');

        next();
      });
    });

    it('returns nothing if no build is found', function (next) {
      bffs.meta(extend({}, spec, { name: 'lolcakes' }), function (err, builds) {
        /* istanbul ignore next */
        if (err) return next(err);

        assume(builds).to.be.falsey();

        next();
      });
    });

    it('removes duplicate data', function (next) {
      bffs.meta(spec, function (err, build) {
        /* istanbul ignore next */
        if (err) return next();

        assume(build).is.a('object');
        assume(build.version).equals(spec.version);
        assume(build.name).equals(spec.name);

        assume(build.envs.test).not.include('version');
        assume(build.envs.test).not.include('name');
        assume(build.envs.test).not.include('env');

        assume(build.envs.dev).not.include('version');
        assume(build.envs.dev).not.include('name');
        assume(build.envs.dev).not.include('env');

        next();
      });
    });
  });

  describe('#key', function () {
    it('generates fingerprints based keys for file types', function () {
      assume(bffs.key(data, 'file')).equals('a083jada091tr0l0l01zdjD/example-module.js');
    });

    it('generates a lookup non package-name conflicting key', function () {
      assume(bffs.key(spec)).equals('example-module!test!0.0.1!en-US');
    });

    it('generates a spec based on a given redis key', function () {
      assume(bffs.respec('~~active!example-module!test!0.0.1!en-US')).eql(spec);
    });

    it('generates a spec based on a given build id', function () {
      assume(bffs.respec('example-module!test!0.0.1!en-US')).eql(spec);
    });

    it('adds a dot if the exteions is missing it', function () {
      assume(bffs.key({ fingerprint: 'foo', filename: 'bar.js', extension: 'js' }, 'file'))
        .equals('foo/bar.js');
    });
  });
});
