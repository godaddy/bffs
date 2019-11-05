module.exports = {
  prefix: 'wrhs_tests',
  cdn: {
    test: {
      url: 'http://localhost:4572',
      acl: 'public-read',
      pkgcloud: {
        keyID: 'fakeId',
        key: 'fakeKey',
        provider: 'amazon',
        endpoint: 's3.amazonaws.com',
        region: 'us-west-1',
        forcePathBucket: false
      }
    },
    dev: {
      url: 'http://localhost:4572',
      acl: 'public-read',
      pkgcloud: {
        keyID: 'fakeId',
        key: 'fakeKey',
        provider: 'amazon',
        endpoint: 's3.amazonaws.com',
        region: 'us-west-1',
        forcePathBucket: false
      }
    }
  }
};
