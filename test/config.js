/* eslint no-process-env: 0 */
const crypto = require('crypto');

// Generate random bucket name so to ensure tests preparation
// are not restricted by an existing bucket.
const bucket = `wrhs-${ crypto.randomBytes(4).toString('hex') }`;
const acl = 'public-read';

const s3endpoint = 'http://localhost:4572';
const pkgcloud = {
  accessKeyId: 'fakeId',
  secretAccessKey: 'fakeKey',
  provider: 'amazon',
  endpoint: s3endpoint,
  forcePathBucket: true
};

// Required to run tests on Travis??
process.env.AWS_ACCESS_KEY_ID = 'foobar';
process.env.AWS_SECRET_ACCESS_KEY = 'foobar';

module.exports = {
  prefix: bucket,
  dynamodb: {
    endpoint: 'http://localhost:4569',
    region: 'us-east-1'
  },
  cdn: {
    test: {
      check: `${ s3endpoint }/${ bucket }/`,
      url: s3endpoint,
      pkgcloud,
      acl
    },
    dev: {
      check: `${ s3endpoint }/${ bucket }/`,
      url: s3endpoint,
      pkgcloud,
      acl
    }
  }
};
