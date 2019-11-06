/* eslint no-process-env: 0 */

// Generate random bucket name so to ensure tests preparation
// are not restricted by an existing bucket.
const bucket = 'wrhs-test';
const acl = 'public-read';

const s3endpoint = 'http://localhost:4572';
const pkgcloud = {
  accessKeyId: 'fakeId',
  secretAccessKey: 'fakeKey',
  provider: 'amazon',
  endpoint: s3endpoint,
  forcePathBucket: true
};

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
