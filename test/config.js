const crypto = require('crypto');

// Generate random bucket name so to ensure tests preparation
// are not restricted by an existing bucket.
const s3 = {
  Bucket: `wrhs-${ crypto.randomBytes(4).toString('hex') }`,
  ACL: 'public-read'
};

const s3endpoint = 'http://localhost:4572';
const pkgcloud = {
  accessKeyId: 'fakeId',
  secretAccessKey: 'fakeKey',
  provider: 'amazon',
  endpoint: s3endpoint,
  forcePathBucket: true
};

module.exports = {
  prefix: s3.Bucket,
  dynamodb: {
    endpoint: 'http://localhost:4569',
    region: 'us-east-1'
  },
  s3,
  cdn: {
    test: {
      check: `${ s3endpoint }/${ s3.Bucket }/`,
      url: s3endpoint,
      acl: s3.ACL,
      pkgcloud
    },
    dev: {
      check: `${ s3endpoint }/${ s3.Bucket }/`,
      url: s3endpoint,
      acl: s3.ACL,
      pkgcloud
    }
  }
};
