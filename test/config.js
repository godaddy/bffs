module.exports = {
  prefix: process.env.WRHS_TEST_AWS_PREFIX,
  cdn: {
    test: {
      url: process.env.WRHS_TEST_AWS_TEST_URL,
      acl: 'public-read',
      pkgcloud: {
        keyId: process.env.WRHS_TEST_AWS_KEY_ID,
        key: process.env.WRHS_TEST_AWS_KEY,
        provider: 'amazon',
        endpoint: 's3.amazonaws.com',
        region: 'us-west-1',
        forcePathBucket: false
      }
    },
    dev: {
      url: process.env.WRHS_TEST_AWS_DEV_URL,
      acl: 'public-read',
      pkgcloud: {
        keyId: process.env.WRHS_TEST_AWS_KEY_ID,
        key: process.env.WRHS_TEST_AWS_KEY,
        provider: 'amazon',
        endpoint: 's3.amazonaws.com',
        region: 'us-west-1',
        forcePathBucket: false
      }
    }
  }
};
