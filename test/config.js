module.exports = {
  prefix: 'wrhs_tests',
  dynamodb: {
    endpoint: 'http://localhost:4569',
    region: 'us-east-1'
  },
  cdn: {
    test: {
      acl: 'public-read',
      pkgcloud: {
        keyID: 'fakeId',
        key: 'fakeKey',
        provider: 'amazon',
        endpoint: 'http://localhost:4572/',
        region: 'us-west-1',
        forcePathBucket: false
      }
    },
    dev: {
      acl: 'public-read',
      pkgcloud: {
        keyID: 'fakeId',
        key: 'fakeKey',
        provider: 'amazon',
        endpoint: 'http://localhost:4572/',
        region: 'us-west-1',
        forcePathBucket: false
      }
    }
  }
};
