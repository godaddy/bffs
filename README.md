# BFFS (Build files finder service)

BFFS is a module that helps with the storage and retrieval of build files for [`warehouse.ai`][warehouse.ai].

It stores the build files and gzip version of the build file. In addition to
that it also stores all meta for a given build so it can be retrieved again by
searching for the spec it was build with (version, name and environment)

## Installation

```
npm install --save bffs
```

## API

In all API examples we assume that you've already created a new BFFS instance,
this is how you setup a new instance:

```js
'use strict';

var BFFS = require('bffs');

var bffs = new BFFS({
  store: require('ioredis')()
});
```

As you can see in the example above, the constructor accepts a single options
argument this options object can contain the following properties:

- `store` an  `ioredis` client instance that can be used
- `cache` Options that are directly passed in to the `hotpath` module for
  hotpath cache optimization.
- `cdn` The root or prefix of the build files URL's.
- `env` An array of environments that we support.

#### bffs.build

Fetch a completed build file. The method requires the following arguments:

- The fingerprint + extension of the buildfile that you're trying to retrieve.
- Boolean that indicates if you want to have a pre-gzipped version instead.
- Completion callback which follows the error first callback pattern.

```js
bffs.build('0810984t019823098d08a.js', false, function (err, data) {

});
```

#### bffs.search

Search for previously published builds of modules. This method accepts 3
arguments:

- Object with a build specification that needs to be fetched. It requires the
  name, version and env properties to be set.
- Optional argument which will be passed in to the `key` method to generate a
  specific a key. **Only used internally**
- Completion callback which follows the error first callback pattern.

```js
bffs.search({
  name: 'wsb-pancakes',
  version: '1.2.4',
  env: 'test'
}, function (err, meta) {

});
```

#### bffs.publish

Publish a new build, this does a couple of things. It stores the `content`
and `compressed` keys as "build" files using the `fingerprint` key as file name.
The rest of the data is stored as meta build data which should give some
detailed information about the build it self.

This method requires 3 arguments:

- Object with a build specification that needs to be fetched. It requires the
  name, version and env properties to be set.
- Object with a files array that contains `compressed`, `content` and `fingerprint` as minimum requirements.
  You don't need to add the `name`, `version` and `env` properties to this
  object as we will merge those in from the first supplied argument.
- Completion callback which follows the error first callback pattern.

```js
bffs.publish({
  name: 'wsb-pancakes',
  version: '1.2.5',
  env: 'test'
}, {
  promote: false, // prevents creating BuildHead based on the created Build
  files: [{
    content: fs.readFileSync('file.js'),
    compressed: fs.readFileSync('file.js.gz'),
    fingerprint: fingerprinter(fs.readFileSync('file.js')).id
  }]
}, function (err) {

});
```

#### bffs.meta

Get all the meta data from a given build for every support environment. This
method requires 2 arguments:

- Object with a build specification that needs to be fetched. It requires the
  name, version properties to be set.
- Completion callback which follows the error first callback pattern.

```js
bffs.meta({
  name: 'wsb-pancakes',
  version: '1.1.1'
}, function (err, meta) {

});
```

#### bffs.start

Store the build id as indication that a given package is already building. The
build will stay active until the supplied timeout or `stop` method has been
called. This method requires 4 arguments:

- Object with a build specification that needs to be fetched. It requires the
  name, version and env properties to be set.
- The id of the build.
- Timeout of the build as number.
- Completion callback which follows the error first callback pattern.

```js
bffs.start({
  name: 'wsb-pancakes',
  version: '1.2.5',
  env: 'test'
}, '98798ad0-afd7a0-afasdfas901', 27E2, function (err) {

});
```

#### bffs.active

Check if a given build set is active and returns the `jobs` of the builds if this is the
case. It requires 2 arguments:

- Object with a build specification that needs to be fetched. It requires the
  name, version and env properties to be set.
- Completion callback which follows the error first callback pattern.

```js
bffs.active({
  name: 'wsb-pancakes',
  version: '1.2.5',
  env: 'test'
}, function (err, jobs) {
  // jobs is an array with a `key` and `value` property.
  // The `value` is the `id` of the job.
});
```

#### bffs.stop

Stop and remove the indication that a build is running. It requires 2 arguments:

```js
bffs.stop({
  name: 'wsb-pancakes',
  version: '1.2.5',
  env: 'test'
}, function (err) {

});
```

## Tests
```sh
npm test
```

## License

MIT

[warehouse.ai]: https://github.com/godaddy/warehouse.ai
